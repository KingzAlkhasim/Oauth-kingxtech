# KingxTech Supabase email templates

Branded HTML email templates for Supabase Auth. Set the sender address in Supabase Auth email settings to `noreply@kingxtech.name.ng`; replies to this address are not monitored. The footer directs questions to `hello@kingxtech.name.ng`.

Upload your own PNG assets to `public/email/logo.png` and `public/email/logo@2x.png`. Templates reference the 60px logo at `https://auth.kingxtech.name.ng/email/logo.png` and include the @2x image as a `srcset` candidate. The PNG files are intentionally not included in this commit.

## Template subjects

| File | Subject |
| --- | --- |
| `confirm-signup.html` | Confirm your KingxTech account |
| `invite.html` | You’re invited to KingxTech |
| `magic-link.html` | Your KingxTech sign-in link |
| `change-email.html` | Confirm your new email address |
| `reset-password.html` | Reset your KingxTech password |
| `reauthentication.html` | Verify your KingxTech identity |

## Template variables

Templates use Supabase Auth template variables such as `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .Email }}`, and `{{ .SiteURL }}` where applicable. For link-based flows, replace the action link with `{{ .ConfirmationURL }}`; the reauthentication template presents `{{ .Token }}` as a one-time code.

All templates use inline CSS and table-based layout for email-client compatibility. Each includes a plain-text fallback instruction and the sentence: “If you didn't request this, you can ignore this email.” No Supabase branding is included.
