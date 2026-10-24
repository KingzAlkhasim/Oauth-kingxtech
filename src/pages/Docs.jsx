import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { BookOpen, Search, ArrowLeft, ArrowRight } from 'lucide-react';
import Logo from '../components/Logo';
import { Card } from '../components/ui';
import useSeo from '../lib/useSeo';
import { buildDocPages, splitVideoBlocks, searchDocs } from '../lib/docs';

// Every Markdown file in src/docs becomes a page. See src/docs/_how-to-edit.md.
const RAW = import.meta.glob('../docs/*.md', { query: '?raw', import: 'default', eager: true });
const PAGES = buildDocPages(RAW);

const textOf = (children) => (Array.isArray(children) ? children : [children]).map((c) => (typeof c === 'string' ? c : c?.props?.children ? textOf(c.props.children) : '')).join('');
const idFor = (children) => textOf(children).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const MARKDOWN = {
  h2: ({ children }) => <h2 id={idFor(children)} className="font-display text-xl mt-8 mb-2 scroll-mt-6">{children}</h2>,
  h3: ({ children }) => <h3 id={idFor(children)} className="font-display text-base mt-6 mb-1.5 scroll-mt-6">{children}</h3>,
  p: ({ children }) => <p className="text-[14.5px] leading-relaxed text-white/85 my-3">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-3 space-y-1.5 text-[14.5px] leading-relaxed text-white/85">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-3 space-y-1.5 text-[14.5px] leading-relaxed text-white/85">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  code: ({ children }) => <code className="font-mono text-[13px] bg-white/10 rounded px-1.5 py-0.5 break-words">{children}</code>,
  pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[13px]">{children}</pre>,
  a: ({ href = '', children }) => (href.startsWith('/')
    ? <Link to={href} className="text-kxblue underline">{children}</Link>
    : <a href={href} target="_blank" rel="noopener noreferrer" className="text-kxblue underline break-words">{children}</a>),
};

function Video({ id }) {
  return (
    <div className="my-5 aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black">
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${id}`}
        title="Video tutorial"
        loading="lazy"
        allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        className="h-full w-full"
      />
    </div>
  );
}

function PageList({ activeSlug, onPick }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Documentation pages">
      {PAGES.map((p) => (
        <Link
          key={p.slug}
          to={`/docs/${p.slug}`}
          onClick={onPick}
          className={`min-h-11 flex items-center rounded-lg px-3 text-[13.5px] ${activeSlug === p.slug ? 'bg-white/8 text-white' : 'text-kxmist hover:text-white hover:bg-white/[0.03]'}`}
        >
          {p.title}
        </Link>
      ))}
    </nav>
  );
}

export default function Docs() {
  const { slug } = useParams();
  const location = useLocation();
  const [query, setQuery] = useState('');
  const page = PAGES.find((p) => p.slug === slug);
  const index = page ? PAGES.indexOf(page) : -1;
  const results = useMemo(() => searchDocs(PAGES, query), [query]);

  useSeo({
    title: page ? `${page.title} — KingxTech Docs` : 'Documentation — KingxTech',
    description: page?.summary || 'Guides for building, publishing and managing projects on KingxTech.',
  });

  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (el) { el.scrollIntoView(); return; }
    }
    window.scrollTo(0, 0);
  }, [slug, location.hash]);

  const blocks = page ? splitVideoBlocks(page.body) : [];
  const searching = query.trim().length > 1;

  return (
    <div className="min-h-screen px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="flex items-center justify-between gap-3 mb-6">
          <Link to="/" aria-label="KingxTech home"><Logo /></Link>
          <Link to="/welcome" className="min-h-11 inline-flex items-center text-[13px] text-kxmist hover:text-white">Open my account</Link>
        </header>

        <div className="relative mb-5">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-kxmist pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the docs"
            aria-label="Search the docs"
            className="w-full min-h-11 rounded-xl border border-white/12 bg-white/[0.02] pl-10 pr-3.5 text-sm outline-none focus:border-kxblue"
          />
        </div>

        {searching ? (
          <div className="flex flex-col gap-3">
            <p className="text-[12.5px] text-kxmist">{results.length} result{results.length === 1 ? '' : 's'} for “{query.trim()}”</p>
            {results.length === 0 && <p className="text-[14px] text-kxmist">Nothing found. Try fewer or different words, or <Link to="/help" className="text-kxblue underline">ask us</Link>.</p>}
            {results.map(({ page: p, snippet }) => (
              <Link key={p.slug} to={`/docs/${p.slug}`} onClick={() => setQuery('')}>
                <Card className="p-4 rounded-xl hover:border-white/25 transition-colors">
                  <p className="font-display text-[15px]">{p.title}</p>
                  <p className="text-[12.5px] text-kxmist mt-1 break-words">{snippet}</p>
                </Card>
              </Link>
            ))}
          </div>
        ) : !page && slug ? (
          <div className="py-10">
            <h1 className="font-display text-2xl">That page does not exist</h1>
            <p className="text-[14px] text-kxmist mt-2">Pick a page from the <Link to="/docs" className="text-kxblue underline">documentation home</Link>.</p>
          </div>
        ) : !page ? (
          <div>
            <div className="flex items-center gap-3 mb-2">
              <BookOpen size={22} className="text-kxpurple" />
              <h1 className="font-display text-3xl">Documentation</h1>
            </div>
            <p className="text-[14.5px] text-kxmist max-w-xl mb-6">Guides for building, publishing and managing your projects on KingxTech.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {PAGES.map((p) => (
                <Link key={p.slug} to={`/docs/${p.slug}`}>
                  <Card className="p-4 rounded-xl h-full hover:border-white/25 transition-colors">
                    <p className="font-display text-[15px]">{p.title}</p>
                    {p.summary && <p className="text-[12.5px] text-kxmist mt-1 leading-snug">{p.summary}</p>}
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <div className="md:grid md:grid-cols-[220px_minmax(0,1fr)] md:gap-10">
            <aside className="mb-6 md:mb-0">
              <details className="md:hidden rounded-xl border border-white/10 bg-white/[0.02]">
                <summary className="min-h-11 flex items-center px-3.5 text-[13.5px] cursor-pointer">All pages</summary>
                <div className="px-2 pb-2"><PageList activeSlug={slug} onPick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')} /></div>
              </details>
              <div className="hidden md:block sticky top-6"><PageList activeSlug={slug} /></div>
            </aside>
            <article className="min-w-0">
              <h1 className="font-display text-3xl leading-tight">{page.title}</h1>
              {page.summary && <p className="text-[15px] text-kxmist mt-2">{page.summary}</p>}
              <div>
                {blocks.map((b, i) => (b.type === 'video'
                  ? <Video key={i} id={b.id} />
                  : <ReactMarkdown key={i} components={MARKDOWN}>{b.text}</ReactMarkdown>))}
              </div>
              <div className="flex items-stretch justify-between gap-3 mt-10 pt-5 border-t border-white/10">
                {index > 0 ? (
                  <Link to={`/docs/${PAGES[index - 1].slug}`} className="min-h-11 flex-1 rounded-xl border border-white/10 p-3 hover:border-white/25">
                    <span className="flex items-center gap-1 text-[11.5px] text-kxmist"><ArrowLeft size={12} /> Previous</span>
                    <span className="text-[13.5px]">{PAGES[index - 1].title}</span>
                  </Link>
                ) : <span className="flex-1" />}
                {index < PAGES.length - 1 ? (
                  <Link to={`/docs/${PAGES[index + 1].slug}`} className="min-h-11 flex-1 rounded-xl border border-white/10 p-3 text-right hover:border-white/25">
                    <span className="flex items-center justify-end gap-1 text-[11.5px] text-kxmist">Next <ArrowRight size={12} /></span>
                    <span className="text-[13.5px]">{PAGES[index + 1].title}</span>
                  </Link>
                ) : <span className="flex-1" />}
              </div>
              <p className="text-[12.5px] text-kxmist mt-8">Did this not answer your question? <Link to="/help" className="text-kxblue underline">Contact support</Link>.</p>
            </article>
          </div>
        )}
      </div>
    </div>
  );
}
