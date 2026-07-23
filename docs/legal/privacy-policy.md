# Privacy Policy

This policy is effective as of the date you create an account or first use this
instance of the Service, whichever is earlier.

In this policy, **"the Service"** means this Arciv instance and **"the Operator"**
(**"we"**, **"us"**) means the individual or entity that runs it. Contact the
Operator at the address published on this instance (shown in the site footer or
Settings). If you self-host, you are the Operator of your own instance.

> This is a general-purpose template that ships with Arciv, not legal advice. It
> aims to be accurate to how the software works, but the Operator is responsible
> for ensuring it fits their obligations (e.g. GDPR/CCPA) and should seek a legal
> review before relying on it.

## 1. What we collect

- **Account data:** your email address and a securely hashed password.
- **Content you save:** links, canonical URLs, titles, descriptions, notes,
  tags, feeds, and feed history.
- **AI provider key:** if you configure one, it is stored **encrypted at rest**
  (envelope encryption, AES-256-GCM) and never returned to you in full.
- **Operational data:** timestamps, rate-limit counters, and error logs needed
  to run and protect the service.

## 2. How we use it

To operate the service: store your links and feeds, fetch page metadata, poll
feeds, and — when you provide a key — send content to **your** chosen AI provider
for classification and summarisation. We do not sell your personal data.

## 3. Third parties

- **Your AI provider** receives the content you choose to process, under that
  provider's own terms and privacy policy.
- **Infrastructure providers** (hosting, database, email delivery) process data
  on our behalf to run the service.

## 4. Data retention and deletion

We keep your data until you delete it. You can **export** all your data or
**permanently delete your account** at any time from Settings. Deletion removes
your account and all associated links, feeds, feed history, and notifications;
short-lived tokens in our cache expire automatically.

## 5. Security

Passwords are hashed with bcrypt. Provider keys are encrypted at rest with a
rotatable master key. All queries are scoped per account so users cannot access
each other's data. No system is perfectly secure; we cannot guarantee absolute
security.

## 6. Your rights

Depending on your jurisdiction you may have rights to access, correct, export,
or delete your data. Export and deletion are self-serve in Settings; for other
requests contact the Operator at the address published on this instance.

## 7. Changes

We may update this policy; material changes will be announced. Continued use
after changes take effect means you accept them.
