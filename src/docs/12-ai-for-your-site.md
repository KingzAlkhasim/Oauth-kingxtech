# Add an AI chatbot to your site
> Let your published site talk to AI without putting a secret key in your code.

{{video: PASTE_YOUTUBE_LINK_HERE}}

## Why this exists

If you put an AI key in your website's code, anyone who opens the page can copy it and spend your money. A KingxTech site is a set of static files, so it cannot hide a key. **AI for your site** solves this: your page asks KingxTech, and KingxTech talks to the AI for you. The key stays on our side and never reaches the visitor.

## Turn it on

1. Open your project and go to **Site Settings**.
2. Find **AI for your site** and tick **Turn on AI for this site**.
3. Choose a **Model**. The price per message is shown next to each one.
4. Under **What should the chatbot do?**, write instructions in plain words, for example: "You are the helpful assistant for Mama Put Bakery in Kaduna. Answer questions about our cakes, prices and opening hours." Visitors never see this, and they cannot change it.
5. Set **Most messages per day**. When the limit is reached, the chatbot stops until tomorrow.
6. Press **Save**, then publish your site.

## Use it in your page

Paste this into your site's JavaScript. The page needs no key. Your project's own code with the right project id is shown in the same card, with a Copy button.

    async function askAI(messages) {
      const res = await fetch('/api/public/ai/YOUR_PROJECT_ID/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      return data.reply;
    }

Send the conversation so far as `messages`. Each message has a `role` (`user` or `assistant`) and `content`. The answer comes back as `reply`. The AI does not remember earlier messages by itself, so send them again each time.

You can also ask [K-XpertAI](/docs/kxpertai) to do it: "Add a chatbot to my site using AI for your site." It knows how.

## Costs and limits

- **Each message is paid from your wallet.** The price depends on the model. Top up in [Billing](/billing). If your wallet is empty, the chatbot stops working for visitors, so keep a balance.
- **Daily limit:** you choose it, from 1 to 5000 messages a day for the whole site.
- **Per visitor:** about 8 messages a minute each, so one person cannot use everything.
- **Message size:** visitors can send up to 2000 characters per message, and the last 12 messages of a conversation are used.
- **Your own site only:** the chatbot works on your published site and your verified custom domains. It does not work from other websites or from the in-app preview.
- Visitors cannot give the AI new instructions that replace yours.

## If it does not work

- The page shows an error saying the chatbot is not available: your wallet may be empty, the model may not be included in your plan, or AI for your site is turned off.
- "Limit for today": raise **Most messages per day**, or wait until tomorrow.
- "Only be used from its own website": you are testing from somewhere other than your published site. Publish and test there.

Still stuck? [Contact support](/help).
