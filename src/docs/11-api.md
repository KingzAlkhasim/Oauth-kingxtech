# Using the KingxTech API
> Call KingxTech's AI models from your own app with an API key. It works like the OpenAI API.

{{video: PASTE_YOUTUBE_LINK_HERE}}

## Before you start

You need a KingxTech account, a wallet balance and an API key. Requests are paid from your wallet, one small charge per request.

The API address used on this page is:

    https://neurocore-rouge.vercel.app

## Create a key

1. Open [Console](/console) and go to **AI Lab**.
2. Find **API Key Vault** and press to create a key. Give it a name.
3. Copy the key straight away. It is shown **once** and cannot be shown again. If you lose it, revoke it and make a new one.

Keys start with `kx_live_` or `kx_test_`. Treat a key like a password: never put it in a website's front-end code or in a public repository. Call the API from a server, and store the key as an [environment variable](/docs/environment-variables).

You can revoke a key at any time in the same place. A revoked key stops working immediately.

## Add funds

Open [Billing](/billing) and top up your wallet through Paystack. Each request deducts its cost from your wallet. If the balance is too low you get a `402` error.

## Send your first request

Send your key in the `Authorization` header.

    curl https://neurocore-rouge.vercel.app/api/v1/chat/completions \
      -H "Authorization: Bearer kx_live_YOUR_KEY" \
      -H "Content-Type: application/json" \
      -d '{
        "model": "gemma",
        "messages": [
          {"role": "system", "content": "You are a helpful assistant."},
          {"role": "user", "content": "Say hello in Hausa."}
        ]
      }'

The answer is in `choices[0].message.content`.

## Use it from JavaScript or Python

Because the API follows the OpenAI format, the official OpenAI libraries work. Set the base URL and your key.

    import OpenAI from 'openai';

    const client = new OpenAI({
      apiKey: process.env.KINGXTECH_API_KEY,
      baseURL: 'https://neurocore-rouge.vercel.app/api/v1',
    });

    const reply = await client.chat.completions.create({
      model: 'gemma',
      messages: [{ role: 'user', content: 'Hello!' }],
    });
    console.log(reply.choices[0].message.content);

The same in Python:

    from openai import OpenAI

    client = OpenAI(
        api_key=os.environ["KINGXTECH_API_KEY"],
        base_url="https://neurocore-rouge.vercel.app/api/v1",
    )
    reply = client.chat.completions.create(
        model="gemma",
        messages=[{"role": "user", "content": "Hello!"}],
    )
    print(reply.choices[0].message.content)

## Choose a model

Get the full, current list with:

    curl https://neurocore-rouge.vercel.app/api/v1/models \
      -H "Authorization: Bearer kx_live_YOUR_KEY"

You can pass a model's `id`, its short name or its label as `model`. Free models such as `qwen`, `llama`, `nemotron`, `deepseek` and `gemma` work on every plan. Stronger models need a paid plan, and a few need Pro+. If your plan does not include a model you get a clear error telling you which plan it needs.

## What it costs

Each request has a fixed price that depends on the model. Free models cost the least. Premium models cost more. The price is taken from your wallet before the answer is generated. Your usage appears in **Console → AI Lab → API key usage**.

Some models also have a monthly request limit. When you reach it you get a `402` error.

## Limits

- **10 requests per minute** per account. More returns a `429` error. Wait a minute and try again.
- Text only. Images, files and tool calls are not supported.
- Only the last 40 messages of a conversation are used.
- API requests cannot read or change your projects.
- Streaming (`"stream": true`) works, but the answer arrives in one piece at the end, not word by word.

## Errors

- `400`: something is missing or wrong in your request, such as an unknown model name or empty `messages`.
- `401`: the key is missing, wrong or revoked.
- `402`: your wallet balance is too low, the model needs a paid plan, or a monthly limit was reached.
- `403`: the model needs Pro+, or the account is suspended.
- `429`: too many requests this minute.
- `502`: the AI provider failed. Try again shortly.

Errors come back as JSON with a readable `message`.

Need help? [Contact support](/help).
