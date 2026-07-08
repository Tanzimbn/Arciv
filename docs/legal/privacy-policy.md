# Privacy Policy

**Effective date:** _{{EFFECTIVE_DATE}}_
**Operator:** _{{OPERATOR_LEGAL_NAME}}_ ("we", "us")
**Contact:** _{{CONTACT_EMAIL}}_

> **Template.** This is a starting point for the hosted deployment of Arciv, not
> legal advice. Fill in every `{{PLACEHOLDER}}`, adjust to your jurisdiction and
> applicable law (e.g. GDPR/CCPA), and have it reviewed before publishing.

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
requests contact _{{CONTACT_EMAIL}}_.

## 7. Changes

We may update this policy; material changes will be announced. Continued use
after changes take effect means you accept them.
