# Email Plugin & Agent Guide

## Overview

The Email plugin provides comprehensive email management capabilities for Ronin agents, supporting multiple email accounts with IMAP (incoming) and SMTP (outgoing) protocols. The Email Manager agent provides a web-based interface and HTTP API for managing email accounts and operations.

## Features

- **Multiple Account Support**: Connect and manage multiple email accounts simultaneously
- **IMAP Integration**: Monitor inboxes, fetch emails, search, and manage messages
- **SMTP Integration**: Send emails, reply, forward with full attachment support
- **Real-time Monitoring**: IMAP IDLE support for instant new email notifications
- **Event System Integration**: Emit and listen to email events for inter-agent communication
- **Web Management UI**: Beautiful interface for managing accounts and viewing emails
- **REST API**: Full HTTP API for programmatic email management

## Quick Start

### 1. Add an Email Account

```typescript
// Using the plugin directly
const account = await this.api.email?.addAccount({
  name: "Work Email",
  email: "user@example.com",
  imap: {
    host: "imap.example.com",
    port: 993,
    secure: true,
    auth: { user: "user@example.com", pass: "password" }
  },
  smtp: {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    auth: { user: "user@example.com", pass: "password" }
  }
});
```

### 2. Access the Management UI

Navigate to `http://localhost:3000/email/` in your browser to access the web interface.

### 3. Monitor for New Emails

```typescript
// Start monitoring
await this.api.email?.startMonitoring(account.id);

// Register handler for new emails
this.api.email?.onNewEmail(account.id, (email) => {
  console.log(`New email: ${email.subject} from ${email.from[0]?.address}`);
  
  // Emit event for other agents
  this.api.events.emit("email:new", {
    accountId: account.id,
    email
  });
});
```

## Plugin API Reference

### Account Management

#### `addAccount(config)`

Add a new email account with IMAP and SMTP configuration.

**Parameters:**
- `config.name` (string): Display name for the account
- `config.email` (string): Email address
- `config.imap` (object): IMAP settings
  - `host` (string): IMAP server hostname
  - `port` (number): IMAP port (typically 993 for SSL, 143 for STARTTLS)
  - `secure` (boolean): Use SSL/TLS
  - `auth.user` (string): Username (usually email address)
  - `auth.pass` (string): Password or app password
- `config.smtp` (object): SMTP settings
  - `host` (string): SMTP server hostname
  - `port` (number): SMTP port (typically 587 for STARTTLS, 465 for SSL)
  - `secure` (boolean): Use SSL/TLS
  - `auth.user` (string): Username (usually email address)
  - `auth.pass` (string): Password or app password

**Returns:** `Promise<{ id: string; email: string; name: string }>`

**Example:**
```typescript
const account = await this.api.email?.addAccount({
  name: "Gmail",
  email: "user@gmail.com",
  imap: {
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: "user@gmail.com", pass: "app-password" }
  },
  smtp: {
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: "user@gmail.com", pass: "app-password" }
  }
});
```

#### `removeAccount(accountId)`

Remove an email account and stop monitoring.

**Parameters:**
- `accountId` (string): Account ID from `addAccount`

**Returns:** `Promise<{ success: boolean }>`

#### `listAccounts()`

List all configured accounts (without sensitive data).

**Returns:** `Promise<Array<{ id: string; name: string; email: string; isMonitoring: boolean; createdAt: number }>>`

### Reading Emails

#### `getInbox(accountId, options?)`

Fetch emails from the inbox.

**Parameters:**
- `accountId` (string): Account ID
- `options.limit` (number, optional): Maximum number of emails (default: 50)
- `options.offset` (number, optional): Offset for pagination

**Returns:** `Promise<Array<EmailMessage>>`

**Example:**
```typescript
const emails = await this.api.email?.getInbox(accountId, { limit: 20 });
emails?.forEach(email => {
  console.log(`${email.subject} from ${email.from[0]?.address}`);
});
```

#### `getEmail(accountId, messageId)`

Get full details of a single email including body content.

**Parameters:**
- `accountId` (string): Account ID
- `messageId` (string): Email UID

**Returns:** `Promise<EmailMessage>`

#### `searchEmails(accountId, query, options?)`

Search emails by subject, body, or sender.

**Parameters:**
- `accountId` (string): Account ID
- `query` (string): Search query
- `options.limit` (number, optional): Maximum results
- `options.folder` (string, optional): Folder to search (default: "INBOX")

**Returns:** `Promise<Array<EmailMessage>>`

### Sending Emails

#### `sendEmail(accountId, to, subject, body, options?)`

Send an email via SMTP.

**Parameters:**
- `accountId` (string): Account ID
- `to` (string | string[]): Recipient email address(es)
- `subject` (string): Email subject
- `body` (string): Email body text
- `options.cc` (string | string[], optional): CC recipients
- `options.bcc` (string | string[], optional): BCC recipients
- `options.html` (boolean, optional): Send as HTML
- `options.replyTo` (string, optional): Reply-To address
- `options.attachments` (array, optional): Attachment files

**Returns:** `Promise<{ messageId: string; success: boolean }>`

**Example:**
```typescript
await this.api.email?.sendEmail(
  accountId,
  "recipient@example.com",
  "Hello from Ronin",
  "This is an automated email sent by a Ronin agent.",
  {
    cc: ["cc@example.com"],
    html: false
  }
);
```

#### `replyToEmail(accountId, messageId, body, options?)`

Reply to an existing email.

**Parameters:**
- `accountId` (string): Account ID
- `messageId` (string): Original email UID
- `body` (string): Reply body
- `options.html` (boolean, optional): Send as HTML
- `options.replyAll` (boolean, optional): Reply to all recipients
- `options.quote` (boolean, optional): Include quoted original message

**Returns:** `Promise<{ messageId: string; success: boolean }>`

#### `forwardEmail(accountId, messageId, to, body?)`

Forward an email to other recipients.

**Parameters:**
- `accountId` (string): Account ID
- `messageId` (string): Email UID to forward
- `to` (string | string[]): Forward recipients
- `body` (string, optional): Additional message body

**Returns:** `Promise<{ messageId: string; success: boolean }>`

### Email Management

#### `deleteEmail(accountId, messageId, options?)`

Delete or trash an email.

**Parameters:**
- `accountId` (string): Account ID
- `messageId` (string): Email UID
- `options.permanent` (boolean, optional): Permanently delete (default: false, moves to trash)

**Returns:** `Promise<{ success: boolean }>`

#### `markRead(accountId, messageId)`

Mark an email as read.

**Parameters:**
- `accountId` (string): Account ID
- `messageId` (string): Email UID

**Returns:** `Promise<{ success: boolean }>`

#### `markUnread(accountId, messageId)`

Mark an email as unread.

**Parameters:**
- `accountId` (string): Account ID
- `messageId` (string): Email UID

**Returns:** `Promise<{ success: boolean }>`

### Monitoring

#### `startMonitoring(accountId)`

Start IMAP IDLE monitoring for real-time new email notifications.

**Parameters:**
- `accountId` (string): Account ID

**Returns:** `Promise<{ success: boolean }>`

**Note:** Monitoring must be started before `onNewEmail` callbacks will fire.

#### `stopMonitoring(accountId)`

Stop monitoring an account.

**Parameters:**
- `accountId` (string): Account ID

**Returns:** `Promise<{ success: boolean }>`

#### `onNewEmail(accountId, callback)`

Register a callback function for new email notifications.

**Parameters:**
- `accountId` (string): Account ID
- `callback` (function): Callback receiving `EmailMessage` object

**Example:**
```typescript
this.api.email?.onNewEmail(accountId, (email) => {
  console.log(`New email: ${email.subject}`);
  // Process email with AI, auto-respond, etc.
});
```

#### `offNewEmail(accountId, callback)`

Unregister a new email callback.

### Folders

#### `listFolders(accountId)`

List all folders/mailboxes for an account.

**Parameters:**
- `accountId` (string): Account ID

**Returns:** `Promise<Array<{ name: string; path: string; specialUse?: string }>>`

## Email Manager Agent

The Email Manager agent (`email-manager.ts`) provides:

1. **Web Management UI** at `/email/`
2. **REST API** endpoints for all operations
3. **Event System Integration** for inter-agent communication

### HTTP API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/email/` | GET | Management UI (HTML) |
| `/email/accounts` | GET | List all accounts |
| `/email/accounts` | POST | Add new account |
| `/email/accounts/:id` | DELETE | Remove account |
| `/email/accounts/:id/inbox` | GET | Get inbox emails |
| `/email/accounts/:id/send` | POST | Send email |
| `/email/accounts/:id/messages/:msgId` | GET | Get email details |
| `/email/accounts/:id/messages/:msgId/reply` | POST | Reply to email |
| `/email/accounts/:id/messages/:msgId/forward` | POST | Forward email |
| `/email/accounts/:id/messages/:msgId` | DELETE | Delete email |
| `/email/accounts/:id/messages/:msgId/mark-read` | POST | Mark as read |
| `/email/accounts/:id/messages/:msgId/mark-unread` | POST | Mark as unread |
| `/email/accounts/:id/search?q=query` | GET | Search emails |
| `/email/accounts/:id/folders` | GET | List folders |

## Event System Integration

### Listening for Email Events

The email plugin and agent emit events that other agents can listen to:

```typescript
// Listen for new emails
this.api.events.on("email:new", (data) => {
  const { accountId, email } = data as any;
  console.log(`New email from ${email.from[0]?.address}: ${email.subject}`);
  
  // Process with AI
  const response = await this.api.ai.complete(
    `Analyze this email and suggest a response: ${email.snippet}`
  );
});

// Listen for sent emails
this.api.events.on("email:sent", (data) => {
  console.log(`Email sent: ${data.subject}`);
});

// Listen for deleted emails
this.api.events.on("email:deleted", (data) => {
  console.log(`Email deleted: ${data.messageId}`);
});

// Listen for errors
this.api.events.on("email:error", (data) => {
  console.error(`Email error: ${data.error}`);
});
```

### Commanding the Email Agent

Other agents can send commands to the email manager agent:

```typescript
// Reply to an email
this.api.events.beam("email-manager", "email:command", {
  action: "reply",
  accountId: "account-id",
  messageId: "message-uid",
  payload: {
    body: "Thank you for your email!",
    quote: true
  }
});

// Delete an email
this.api.events.beam("email-manager", "email:command", {
  action: "delete",
  accountId: "account-id",
  messageId: "message-uid"
});

// Send a new email
this.api.events.beam("email-manager", "email:command", {
  action: "send",
  accountId: "account-id",
  payload: {
    to: "recipient@example.com",
    subject: "Automated Email",
    body: "This email was sent by an AI agent",
    cc: ["cc@example.com"]
  }
});

// Forward an email
this.api.events.beam("email-manager", "email:command", {
  action: "forward",
  accountId: "account-id",
  messageId: "message-uid",
  payload: {
    to: "forward@example.com",
    body: "FYI"
  }
});

// Mark as read/unread
this.api.events.beam("email-manager", "email:command", {
  action: "mark-read",
  accountId: "account-id",
  messageId: "message-uid"
});
```

### Querying the Email Agent

Use the query system for request/response patterns:

```typescript
try {
  const result = await this.api.events.query(
    "email-manager",
    "email:command",
    {
      action: "send",
      accountId: "account-id",
      payload: {
        to: "test@example.com",
        subject: "Test",
        body: "Test message"
      }
    },
    5000 // timeout in ms
  );
  console.log("Email sent successfully:", result);
} catch (error) {
  console.error("Failed to send email:", error);
}
```

## Common Email Provider Settings

### Gmail

**IMAP:**
- Host: `imap.gmail.com`
- Port: `993`
- Secure: `true`
- Note: Requires an [App Password](https://support.google.com/accounts/answer/185833) instead of regular password

**SMTP:**
- Host: `smtp.gmail.com`
- Port: `587`
- Secure: `false` (STARTTLS)

### Outlook/Hotmail

**IMAP:**
- Host: `outlook.office365.com`
- Port: `993`
- Secure: `true`

**SMTP:**
- Host: `smtp.office365.com`
- Port: `587`
- Secure: `false` (STARTTLS)

### Yahoo Mail

**IMAP:**
- Host: `imap.mail.yahoo.com`
- Port: `993`
- Secure: `true`

**SMTP:**
- Host: `smtp.mail.yahoo.com`
- Port: `587`
- Secure: `false` (STARTTLS)

### Custom/Corporate Email

Check with your email provider or IT department for:
- IMAP server hostname and port
- SMTP server hostname and port
- Whether SSL/TLS is required
- Authentication requirements (username format, app passwords, etc.)

## Example: AI Email Assistant Agent

```typescript
import { BaseAgent } from "@ronin/agent";

export default class EmailAssistantAgent extends BaseAgent {
  async execute(): Promise<void> {
    // Listen for new emails
    this.api.events.on("email:new", async (data: any) => {
      const { accountId, email } = data;
      
      // Analyze email with AI
      const analysis = await this.api.ai.complete(
        `Analyze this email and determine if it needs a response:\n\n` +
        `From: ${email.from[0]?.address}\n` +
        `Subject: ${email.subject}\n` +
        `Body: ${email.snippet}\n\n` +
        `Should I respond? If yes, draft a professional response.`
      );
      
      // If AI suggests responding, send reply
      if (analysis.includes("Yes") || analysis.includes("respond")) {
        const response = await this.api.ai.complete(
          `Draft a professional email response to:\n\n` +
          `Subject: ${email.subject}\n` +
          `Content: ${email.snippet}\n\n` +
          `Write a concise, professional response.`
        );
        
        // Send reply via email manager
        this.api.events.beam("email-manager", "email:command", {
          action: "reply",
          accountId,
          messageId: email.id,
          payload: {
            body: response,
            quote: true
          }
        });
      }
    });
  }
}
```

## Data Storage

Account configurations are stored in `~/.ronin/data/email-accounts.json`. Passwords are stored in plain text - consider using environment variables or encryption for production use.

## Security Considerations

1. **Password Storage**: Passwords are stored in plain text. For production:
   - Use environment variables for sensitive credentials
   - Implement encryption for stored passwords
   - Use app-specific passwords when available (Gmail, etc.)

2. **Network Security**: Ensure IMAP/SMTP connections use SSL/TLS when available.

3. **Access Control**: The web UI and API have no authentication by default. Add authentication middleware for production deployments.

4. **Rate Limiting**: Be mindful of email provider rate limits when sending multiple emails.

## Troubleshooting

### Connection Errors

- **"IMAP connection failed"**: Verify host, port, and credentials. Check if SSL/TLS settings are correct.
- **"SMTP connection failed"**: Verify SMTP settings. Some providers require STARTTLS (secure: false on port 587).
- **Authentication errors**: Ensure you're using the correct username format and password/app password.

### Monitoring Not Working

- Ensure `startMonitoring()` is called after adding the account
- Check that IMAP IDLE is supported by your email provider
- Verify the account is not already being monitored elsewhere

### Emails Not Appearing

- Check the correct folder/mailbox is selected
- Verify IMAP access is enabled in your email account settings
- Some providers require enabling "Less secure app access" or using app passwords

## See Also

- [Plugin Development Guide](PLUGINS.md) - General plugin documentation
- [Event System](docs/book/chapters/20-event-system.html) - Inter-agent communication
- [Agent Examples](docs/book/chapters/12-agent-examples.html) - More agent examples
