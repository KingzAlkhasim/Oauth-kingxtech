import { useCallback, useEffect, useState } from 'react';
import { Bot, Copy, Check } from 'lucide-react';
import { Card, Button } from './ui';
import { getSiteAi, saveSiteAi } from '../lib/projectFiles';
import { friendlyError } from '../lib/errors';
import { copyText } from '../lib/copyText';

const snippetFor = (projectId) => `async function askAI(messages) {
  const res = await fetch('/api/public/ai/${projectId}/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.reply;
}

// Example: const answer = await askAI([{ role: 'user', content: 'Hello!' }]);`;

export default function SiteAiCard({ projectId }) {
  const [form, setForm] = useState(null);
  const [models, setModels] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await getSiteAi(projectId);
      setForm(data.settings);
      setModels(data.models || []);
      setError('');
    } catch (err) { setError(friendlyError(err)); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      const data = await saveSiteAi(projectId, form);
      setForm(data.settings);
      setNotice(data.settings.enabled ? 'Saved. Your site can now use the AI.' : 'Saved. AI for your site is off.');
    } catch (err) { setError(friendlyError(err)); }
    finally { setSaving(false); }
  };

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const cost = models.find((m) => m.code === form?.modelCode)?.costUsd;

  return (
    <Card className="p-4 rounded-xl">
      <div className="flex items-center gap-2 mb-1">
        <Bot size={15} className="text-kxpurple" />
        <h3 className="text-[14px] font-semibold">AI for your site</h3>
      </div>
      <p className="text-[11.5px] text-kxmist leading-relaxed">
        Add a chatbot or AI feature to your published site without putting a key in your code. Your site asks KingxTech, and KingxTech talks to the AI for you.
      </p>
      {error && <p className="mt-3 text-[12px] text-red-300">{error}</p>}
      {notice && <p className="mt-3 text-[12px] text-green-300">{notice}</p>}
      {!form && !error && <p className="mt-3 text-[12px] text-kxmist">Loading…</p>}
      {form && (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex items-center gap-2 min-h-11 text-[13px]">
            <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            Turn on AI for this site
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-kxmist">
            Model
            <select
              value={form.modelCode}
              onChange={(e) => set({ modelCode: e.target.value })}
              className="min-h-11 rounded-lg border border-white/12 bg-kxsurface2 px-3 text-[13px] text-white"
            >
              {!models.some((m) => m.code === form.modelCode) && <option value={form.modelCode}>{form.modelCode}</option>}
              {models.map((m) => <option key={m.code} value={m.code}>{m.label} (${m.costUsd.toFixed(2)} per message)</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-kxmist">
            What should the chatbot do? (visitors never see this)
            <textarea
              value={form.systemPrompt}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              maxLength={2000}
              rows={4}
              placeholder="You are the helpful assistant for Mama Put Bakery in Kaduna. Answer questions about our cakes, prices and opening hours."
              className="rounded-lg border border-white/12 bg-kxsurface2 px-3 py-2 text-[13px] text-white"
            />
          </label>

          <label className="flex flex-col gap-1 text-[12px] text-kxmist">
            Most messages per day (all visitors together)
            <input
              type="number"
              min={1}
              max={5000}
              value={form.dailyLimit}
              onChange={(e) => set({ dailyLimit: e.target.value })}
              className="min-h-11 rounded-lg border border-white/12 bg-kxsurface2 px-3 text-[13px] text-white"
            />
          </label>

          <p className="text-[11.5px] text-kxmist leading-relaxed">
            Each message is paid from your wallet{cost != null ? ` (about $${cost.toFixed(2)} for this model)` : ''}. When the daily limit is reached or your wallet is empty, the chatbot stops until tomorrow or until you top up. It only works on your own published site and custom domains.
          </p>

          <Button variant="glow" onClick={save} loading={saving}>Save</Button>

          <div className="rounded-lg border border-white/10 bg-black/40">
            <div className="flex items-center justify-between pl-3 pr-1 border-b border-white/10">
              <span className="py-1 text-[10px] font-mono uppercase tracking-wider text-kxmist/60">Paste into your site's JavaScript</span>
              <button
                type="button"
                onClick={async () => { if (await copyText(snippetFor(projectId))) { setCopied(true); setTimeout(() => setCopied(false), 1600); } }}
                className="inline-flex items-center gap-1 min-h-8 px-2 rounded-md text-[10.5px] text-kxmist hover:text-white hover:bg-white/10"
              >
                {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}{copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="px-3 py-2 overflow-x-auto text-[11.5px] leading-relaxed text-green-400 font-mono">{snippetFor(projectId)}</pre>
          </div>
          <p className="text-[11.5px] text-kxmist">No key goes in your code. You can also just ask K-XpertAI: "add a chatbot to my site using AI for your site".</p>
        </div>
      )}
    </Card>
  );
}
