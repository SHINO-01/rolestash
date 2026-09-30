# Product news emails

Each `.md` file here is one product-news email to the Rolestash updates list.
Send one with **Actions → Send product news**, using the file name without
`.md` as the campaign. Run it with _send_ off first: that's a dry run that
shows the subject and the number of recipients.

A campaign reaches each address only once, so it's safe to rerun after a
failure. Format:

```text
Subject: Custom columns are here
Button: See what's new | https://rolestash.com/

Plain paragraphs, separated by blank lines. No Markdown formatting: it's
sent as plain text inside the branded email.

Keep it short and useful. The footer adds the one-click unsubscribe link
and our details automatically.
```

The `Button:` line is optional and must use an `https://` link. Name files
by date and topic, e.g. `2026-11-custom-columns.md`. This README is never a
valid campaign, because its name isn't lowercase.
