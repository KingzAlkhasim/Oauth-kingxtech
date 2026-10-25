# Using the KingxTech API
> Use KingxTech's AI models inside your own app or script, step by step, even if you have never used an API before.

{{video: PASTE_YOUTUBE_LINK_HERE}}

## What is this for?

K-XpertAI is the AI inside your KingxTech account. The **API** lets your **own** app talk to the same kind of AI. For example, a chatbot on your website, a WhatsApp bot, or a script that writes product descriptions. Your app sends a question to KingxTech and gets the answer back.

A few words you will see on this page:

- **API:** a way for one program to ask another program for something.
- **API key:** a long secret text that proves the request comes from you. It works like a password.
- **Endpoint:** one address that does one job, such as "send a chat message".
- **Wallet:** the money balance on your KingxTech account. API requests are paid from it.
- **Server:** the part of your app that runs privately, not in the visitor's browser.

## The five steps

1. Create an API key.
2. Put money in your wallet.
3. Choose a model.
4. Send a request from your server.
5. Read the answer.

## Building with K-XpertAI

When you ask K-XpertAI to build something that uses this API, it already knows the address, the two endpoints, how the key works and what the errors mean, so you do not need to explain them. Tell it what you want the app to do. It will also warn you if a plan would expose your key. Other AI assistants can read the same facts at [kingxtech llms.txt](https://auth.kingxtech.name.ng/llms.txt).

## 1. Create a key

1. Open [Console](/console) and go to **AI Lab**.
2. Find **API Key Vault** and create a key. Give it a name you will recognise, such as "My shop chatbot".
3. **Copy the key immediately.** It is shown only once. KingxTech keeps a scrambled version, so it cannot show it again. If you lose it, revoke it and create a new one.

Keys start with `kx_live_` or `kx_test_`. Both work the same way.

**Keep your key secret.** Anyone who has it can spend your wallet money.
- Never put it in website code that visitors can see (HTML, or React code running in the browser).
- Never put it in a public GitHub repository.
- Use it only from a server, and store it as an [environment variable](/docs/environment-variables) named something like `KINGXTECH_API_KEY`.
- If you think it leaked, revoke it in API Key Vault. It stops working immediately.

## 2. Add money to your wallet

Open [Billing](/billing) and top up your wallet through Paystack. Each request takes a small amount from the wallet before the AI answers. If the balance is too low, the request fails with a `402` error and nothing is charged.

## 3. Choose a model

A model is the AI brain that answers. To see all the models you can use:

    curl https://site.kingxtech.name.ng/api/v1/models \
      -H "Authorization: Bearer kx_live_YOUR_KEY"

- Use any model's `id` as the `model` in your request. Its short name, such as `gemma`, also works.
- The free models (`qwen`, `llama`, `nemotron`, `deepseek`, `gemma`) work on every plan and cost the least. Start with one of them.
- Stronger models need a paid plan, and a few need Pro+. If your plan does not include a model, the error tells you which plan it needs.
- Some models also have a monthly request limit.

## What each request costs

Every model has a price per request, set by KingxTech. As examples, a free model costs about $0.02 per request, Claude Haiku 4.5 about $0.03, and Claude Sonnet 5.5 about $0.17. The list from the models endpoint shows the models, and **Console → AI Lab → API key usage** shows what you have spent.

The price is the same however long the question or answer is.

## 4. Send a request

This example uses `curl`, a command that works in most terminals.

    curl https://site.kingxtech.name.ng/api/v1/chat/completions \
      -H "Authorization: Bearer kx_live_YOUR_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "gemma",
        "messages": [
          {"role": "system", "content": "You are a helpful assistant."},
          {"role": "user", "content": "Say hello in Hausa."}
        ]
      }'

What each part means:

- **Authorization:** your key, after the word `Bearer` and a space.
- **model:** which AI to use.
- **messages:** the conversation so far. Each message has a `role` and `content`.
- **system:** optional instructions that set the AI's behaviour, for example "Answer in one short sentence."
- **user:** what the person asked.
- **assistant:** an earlier answer from the AI. Include these to keep a conversation going, because the API does not remember past requests.

## 5. Read the answer

The reply is JSON. The text you want is at `choices[0].message.content`.

    {
      "id": "kx-...",
      "object": "chat.completion",
      "model": "...",
      "choices": [
        { "index": 0, "message": { "role": "assistant", "content": "Sannu!" }, "finish_reason": "stop" }
      ]
    }

## Use it from JavaScript or Python

The API follows the same format as OpenAI's, so the official OpenAI libraries work. You only change the key and the base URL.

JavaScript (run on a server, for example Node.js):

    import OpenAI from 'openai';

    const client = new OpenAI({
      apiKey: process.env.KINGXTECH_API_KEY,
      baseURL: 'https://site.kingxtech.name.ng/api/v1',
    });

    const reply = await client.chat.completions.create({
      model: 'gemma',
      messages: [{ role: 'user', content: 'Hello!' }],
    });
    console.log(reply.choices[0].message.content);

Python:

    import os
    from openai import OpenAI

    client = OpenAI(
        api_key=os.environ["KINGXTECH_API_KEY"],
        base_url="https://site.kingxtech.name.ng/api/v1",
    )
    reply = client.chat.completions.create(
        model="gemma",
        messages=[{"role": "user", "content": "Hello!"}],
    )
    print(reply.choices[0].message.content)

## Limits

- **10 requests per minute** per account. More returns a `429` error. Wait a minute and try again.
- Text only. Images, files and tool calls are not supported.
- Only the last 40 messages of a conversation are used.
- The API cannot read or change your projects.
- Streaming (`"stream": true`) works, but the answer arrives in one piece at the end, not word by word.

## When something goes wrong

Errors come back as JSON with a readable `message`. The number tells you the kind of problem:

- **400:** something is missing or wrong in your request, such as an unknown model name or empty `messages`. Read the message.
- **401:** the key is missing, wrong or revoked. Check you wrote `Bearer`, then a space, then the key.
- **402:** your wallet balance is too low, the model needs a paid plan, or its monthly limit was reached. Top up in [Billing](/billing) or choose another model.
- **403:** the model needs Pro+, or the account is suspended.
- **429:** too many requests this minute. Wait and retry.
- **502:** the AI provider had a problem. Try again shortly.

Common mistakes:
- Copying the key with a space or line break at the end.
- Calling the API from browser code, which exposes your key. To add AI to a site published on KingxTech, use [AI for your site](/docs/ai-for-your-site) instead.
- Forgetting to send earlier messages and expecting the AI to remember them.

Still stuck? [Contact support](/help).
