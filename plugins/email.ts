import type { Plugin } from "../src/plugins/base.js";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { getConfigService } from "../src/config/ConfigService.js";

/**
 * Email account configuration
 */
interface EmailAccountConfig {
  name: string;
  email: string;
  imap: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  };
}

/**
 * Stored account with internal IDs
 */
interface StoredAccount extends EmailAccountConfig {
  id: string;
  createdAt: number;
}

/**
 * Email message structure
 */
interface EmailMessage {
  id: string;
  uid: number;
  from: { name?: string; address: string }[];
  to: { name?: string; address: string }[];
  cc?: { name?: string; address: string }[];
  subject: string;
  date: Date;
  snippet: string;
  body?: string;
  html?: string;
  flags: string[];
  attachments?: { filename: string; contentType: string; size: number }[];
}

/**
 * New email callback
 */
type NewEmailCallback = (email: EmailMessage) => void;

/**
 * Account instance with active connections
 */
interface AccountInstance {
  config: StoredAccount;
  imapClient?: ImapFlow;
  smtpTransport?: Transporter;
  isMonitoring: boolean;
  newEmailHandlers: Set<NewEmailCallback>;
}

// In-memory storage for accounts
const accounts: Map<string, AccountInstance> = new Map();

// File path for persistent storage
const getAccountsFilePath = (): string => {
  try {
    const configService = getConfigService();
    const dataDir = configService.getSystem().dataDir;
    return `${dataDir}/email-accounts.json`;
  } catch {
    // Fallback if config service not initialized
    const dataDir = process.env.RONIN_DATA_DIR || `${process.env.HOME}/.ronin/data`;
    return `${dataDir}/email-accounts.json`;
  }
};

/**
 * Load accounts from disk
 */
const loadAccounts = async (): Promise<StoredAccount[]> => {
  try {
    const filePath = getAccountsFilePath();
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const content = await file.text();
      return JSON.parse(content) as StoredAccount[];
    }
  } catch (error) {
    console.error("[email] Failed to load accounts:", error);
  }
  return [];
};

/**
 * Save accounts to disk
 */
const saveAccounts = async (): Promise<void> => {
  try {
    const filePath = getAccountsFilePath();
    const accountsData = Array.from(accounts.values()).map((a) => a.config);
    await Bun.write(filePath, JSON.stringify(accountsData, null, 2));
  } catch (error) {
    console.error("[email] Failed to save accounts:", error);
  }
};

/**
 * Create IMAP client for an account
 */
const createImapClient = (config: StoredAccount): ImapFlow => {
  return new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: {
      user: config.imap.auth.user,
      pass: config.imap.auth.pass,
    },
    logger: false,
  });
};

/**
 * Create SMTP transport for an account
 */
const createSmtpTransport = (config: StoredAccount): Transporter => {
  return nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.auth.user,
      pass: config.smtp.auth.pass,
    },
  });
};

/**
 * Parse email address from IMAP format
 */
const parseAddress = (
  addr: any
): { name?: string; address: string }[] => {
  if (!addr) return [];
  if (Array.isArray(addr)) {
    return addr.map((a) => ({
      name: a.name || undefined,
      address: a.address || "",
    }));
  }
  if (addr.value && Array.isArray(addr.value)) {
    return addr.value.map((a: any) => ({
      name: a.name || undefined,
      address: a.address || "",
    }));
  }
  return [];
};

/**
 * Convert IMAP message to EmailMessage
 */
const convertMessage = async (
  msg: any,
  client: ImapFlow,
  includeBody: boolean = false
): Promise<EmailMessage> => {
  const envelope = msg.envelope;
  let body: string | undefined;
  let html: string | undefined;
  let snippet = "";

  if (includeBody && msg.source) {
    const source = msg.source.toString();
    // Simple extraction - in production you'd want a proper MIME parser
    const textMatch = source.match(/Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\n\r\n)/i);
    const htmlMatch = source.match(/Content-Type: text\/html[\s\S]*?\r\n\r\n([\s\S]*?)(?=\r\n--|\r\n\r\n)/i);
    
    if (textMatch) body = textMatch[1];
    if (htmlMatch) html = htmlMatch[1];
    snippet = body?.substring(0, 200) || "";
  }

  return {
    id: String(msg.uid),
    uid: msg.uid,
    from: parseAddress(envelope?.from),
    to: parseAddress(envelope?.to),
    cc: parseAddress(envelope?.cc),
    subject: envelope?.subject || "(No Subject)",
    date: envelope?.date ? new Date(envelope.date) : new Date(),
    snippet,
    body,
    html,
    flags: msg.flags ? Array.from(msg.flags) : [],
  };
};

/**
 * Email plugin for managing multiple email accounts
 */
const emailPlugin: Plugin = {
  name: "email",
  description: "Email management plugin with IMAP/SMTP support for multiple accounts",
  methods: {
    /**
     * Add a new email account
     */
    addAccount: async (config: EmailAccountConfig): Promise<{
      id: string;
      email: string;
      name: string;
    }> => {
      if (!config.email || !config.imap || !config.smtp) {
        throw new Error("Invalid account configuration: email, imap, and smtp are required");
      }

      const id = `email_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Test IMAP connection
      const testClient = createImapClient({ ...config, id, createdAt: Date.now() });
      try {
        await testClient.connect();
        await testClient.logout();
        console.log(`[email] IMAP connection verified for ${config.email}`);
      } catch (error) {
        throw new Error(
          `IMAP connection failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      // Test SMTP connection
      const testTransport = createSmtpTransport({ ...config, id, createdAt: Date.now() });
      try {
        await testTransport.verify();
        console.log(`[email] SMTP connection verified for ${config.email}`);
      } catch (error) {
        throw new Error(
          `SMTP connection failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      const storedAccount: StoredAccount = {
        ...config,
        id,
        createdAt: Date.now(),
      };

      accounts.set(id, {
        config: storedAccount,
        isMonitoring: false,
        newEmailHandlers: new Set(),
      });

      await saveAccounts();

      console.log(`[email] Account added: ${config.name} (${config.email})`);

      return {
        id,
        email: config.email,
        name: config.name,
      };
    },

    /**
     * Remove an email account
     */
    removeAccount: async (accountId: string): Promise<{ success: boolean }> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      // Stop monitoring if active
      if (instance.isMonitoring && instance.imapClient) {
        try {
          await instance.imapClient.logout();
        } catch (e) {
          // Ignore logout errors
        }
      }

      accounts.delete(accountId);
      await saveAccounts();

      console.log(`[email] Account removed: ${instance.config.email}`);

      return { success: true };
    },

    /**
     * List all configured accounts (without sensitive data)
     */
    listAccounts: async (): Promise<
      Array<{
        id: string;
        name: string;
        email: string;
        isMonitoring: boolean;
        createdAt: number;
      }>
    > => {
      // Load from disk if not in memory
      if (accounts.size === 0) {
        const saved = await loadAccounts();
        for (const config of saved) {
          accounts.set(config.id, {
            config,
            isMonitoring: false,
            newEmailHandlers: new Set(),
          });
        }
      }

      return Array.from(accounts.values()).map((a) => ({
        id: a.config.id,
        name: a.config.name,
        email: a.config.email,
        isMonitoring: a.isMonitoring,
        createdAt: a.config.createdAt,
      }));
    },

    /**
     * Get emails from inbox
     */
    getInbox: async (
      accountId: string,
      options?: { limit?: number; offset?: number }
    ): Promise<EmailMessage[]> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      const limit = options?.limit || 50;
      const client = createImapClient(instance.config);

      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");

        try {
          const messages: EmailMessage[] = [];
          const mailbox = client.mailbox;
          const total = mailbox?.exists || 0;

          if (total === 0) {
            return [];
          }

          // Fetch most recent messages
          const start = Math.max(1, total - limit + 1);
          const range = `${start}:*`;

          for await (const msg of client.fetch(range, {
            envelope: true,
            flags: true,
            uid: true,
          })) {
            const email = await convertMessage(msg, client, false);
            messages.push(email);
          }

          // Sort by date descending (newest first)
          messages.sort((a, b) => b.date.getTime() - a.date.getTime());

          return messages.slice(0, limit);
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    },

    /**
     * Get a single email by ID
     */
    getEmail: async (
      accountId: string,
      messageId: string
    ): Promise<EmailMessage> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      const client = createImapClient(instance.config);

      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");

        try {
          const uid = parseInt(messageId, 10);
          const msg = await client.fetchOne(String(uid), {
            envelope: true,
            flags: true,
            uid: true,
            source: true,
          }, { uid: true });

          if (!msg) {
            throw new Error(`Message not found: ${messageId}`);
          }

          return await convertMessage(msg, client, true);
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    },

    /**
     * Send an email
     */
    sendEmail: async (
      accountId: string,
      to: string | string[],
      subject: string,
      body: string,
      options?: {
        cc?: string | string[];
        bcc?: string | string[];
        html?: boolean;
        replyTo?: string;
        attachments?: Array<{
          filename: string;
          content: string | Buffer;
          contentType?: string;
        }>;
      }
    ): Promise<{ messageId: string; success: boolean }> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      const transport = createSmtpTransport(instance.config);

      try {
        const mailOptions: nodemailer.SendMailOptions = {
          from: `"${instance.config.name}" <${instance.config.email}>`,
          to: Array.isArray(to) ? to.join(", ") : to,
          subject,
          ...(options?.html ? { html: body } : { text: body }),
          cc: options?.cc
            ? Array.isArray(options.cc)
              ? options.cc.join(", ")
              : options.cc
            : undefined,
          bcc: options?.bcc
            ? Array.isArray(options.bcc)
              ? options.bcc.join(", ")
              : options.bcc
            : undefined,
          replyTo: options?.replyTo,
          attachments: options?.attachments,
        };

        const info = await transport.sendMail(mailOptions);

        console.log(`[email] Email sent from ${instance.config.email} to ${to}`);

        return {
          messageId: info.messageId,
          success: true,
        };
      } finally {
        transport.close();
      }
    },

    /**
     * Reply to an email
     */
    replyToEmail: async (
      accountId: string,
      messageId: string,
      body: string,
      options?: {
        html?: boolean;
        replyAll?: boolean;
        quote?: boolean;
      }
    ): Promise<{ messageId: string; success: boolean }> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      // Get original email
      const original = await emailPlugin.methods.getEmail(accountId, messageId);

      // Determine recipients
      let to = original.from.map((a) => a.address);
      let cc: string[] | undefined;

      if (options?.replyAll) {
        cc = [
          ...original.to.filter((a) => a.address !== instance.config.email).map((a) => a.address),
          ...(original.cc?.filter((a) => a.address !== instance.config.email).map((a) => a.address) || []),
        ];
      }

      // Build reply body
      let replyBody = body;
      if (options?.quote && original.body) {
        const quotedBody = original.body
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        replyBody = `${body}\n\nOn ${original.date.toLocaleString()}, ${original.from[0]?.address} wrote:\n${quotedBody}`;
      }

      // Build reply subject
      const replySubject = original.subject.startsWith("Re:")
        ? original.subject
        : `Re: ${original.subject}`;

      return emailPlugin.methods.sendEmail(accountId, to, replySubject, replyBody, {
        cc,
        html: options?.html,
        replyTo: original.from[0]?.address,
      }) as Promise<{ messageId: string; success: boolean }>;
    },

    /**
     * Forward an email
     */
    forwardEmail: async (
      accountId: string,
      messageId: string,
      to: string | string[],
      body?: string
    ): Promise<{ messageId: string; success: boolean }> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      // Get original email
      const original = await emailPlugin.methods.getEmail(accountId, messageId);

      // Build forward body
      const forwardHeader = `
---------- Forwarded message ----------
From: ${original.from.map((a) => `${a.name || ""} <${a.address}>`).join(", ")}
Date: ${original.date.toLocaleString()}
Subject: ${original.subject}
To: ${original.to.map((a) => `${a.name || ""} <${a.address}>`).join(", ")}
`;

      const forwardBody = body
        ? `${body}\n${forwardHeader}\n${original.body || ""}`
        : `${forwardHeader}\n${original.body || ""}`;

      // Build forward subject
      const forwardSubject = original.subject.startsWith("Fwd:")
        ? original.subject
        : `Fwd: ${original.subject}`;

      return emailPlugin.methods.sendEmail(accountId, to, forwardSubject, forwardBody) as Promise<{
        messageId: string;
        success: boolean;
      }>;
    },

    /**
     * Delete an email (move to trash or permanently delete)
     */
    deleteEmail: async (
      accountId: string,
      messageId: string,
      options?: { permanent?: boolean }
    ): Promise<{ success: boolean }> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      const client = createImapClient(instance.config);

      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");

        try {
          const uid = parseInt(messageId, 10);

          if (options?.permanent) {
            // Permanently delete
            await client.messageDelete(String(uid), { uid: true });
          } else {
            // Move to trash (try common trash folder names)
            const trashFolders = ["Trash", "[Gmail]/Trash", "Deleted Items", "Deleted"];
            let moved = false;

            for (const trash of trashFolders) {
              try {
                await client.messageMove(String(uid), trash, { uid: true });
                moved = true;
                break;
              } catch {
                // Try next folder
              }
            }

            if (!moved) {
              // If no trash folder found, just mark as deleted
              await client.messageFlagsAdd(String(uid), ["\\Deleted"], { uid: true });
            }
          }

          console.log(`[email] Email ${messageId} deleted from ${instance.config.email}`);

          return { success: true };
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    },

    /**
     * Mark email as read
     */
    markRead: async (
      accountId: string,
      messageId: string
    ): Promise<{ success: boolean }> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      const client = createImapClient(instance.config);

      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");

        try {
          const uid = parseInt(messageId, 10);
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
          return { success: true };
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    },

    /**
     * Mark email as unread
     */
    markUnread: async (
      accountId: string,
      messageId: string
    ): Promise<{ success: boolean }> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      const client = createImapClient(instance.config);

      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");

        try {
          const uid = parseInt(messageId, 10);
          await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
          return { success: true };
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    },

    /**
     * Search emails
     */
    searchEmails: async (
      accountId: string,
      query: string,
      options?: { limit?: number; folder?: string }
    ): Promise<EmailMessage[]> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      const limit = options?.limit || 50;
      const folder = options?.folder || "INBOX";
      const client = createImapClient(instance.config);

      try {
        await client.connect();
        const lock = await client.getMailboxLock(folder);

        try {
          const messages: EmailMessage[] = [];

          // Search for messages containing the query in subject or body
          for await (const msg of client.fetch(
            { or: [{ subject: query }, { body: query }, { from: query }] },
            { envelope: true, flags: true, uid: true }
          )) {
            const email = await convertMessage(msg, client, false);
            messages.push(email);

            if (messages.length >= limit) break;
          }

          return messages;
        } finally {
          lock.release();
        }
      } finally {
        await client.logout();
      }
    },

    /**
     * Start monitoring inbox for new emails (IMAP IDLE)
     */
    startMonitoring: async (accountId: string): Promise<{ success: boolean }> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      if (instance.isMonitoring) {
        console.log(`[email] Already monitoring ${instance.config.email}`);
        return { success: true };
      }

      const client = createImapClient(instance.config);
      instance.imapClient = client;

      try {
        await client.connect();

        // Set up event handler for new messages
        client.on("exists", async (data: { path: string; count: number; prevCount: number }) => {
          if (data.count > data.prevCount) {
            console.log(`[email] New email detected in ${instance.config.email}`);

            // Fetch the new messages
            try {
              const lock = await client.getMailboxLock("INBOX");
              try {
                const start = data.prevCount + 1;
                for await (const msg of client.fetch(`${start}:*`, {
                  envelope: true,
                  flags: true,
                  uid: true,
                  source: true,
                })) {
                  const email = await convertMessage(msg, client, true);

                  // Notify all handlers
                  for (const handler of instance.newEmailHandlers) {
                    try {
                      handler(email);
                    } catch (e) {
                      console.error("[email] Error in new email handler:", e);
                    }
                  }
                }
              } finally {
                lock.release();
              }
            } catch (e) {
              console.error("[email] Error fetching new messages:", e);
            }
          }
        });

        // Select INBOX and start IDLE
        await client.mailboxOpen("INBOX");
        instance.isMonitoring = true;

        console.log(`[email] Started monitoring ${instance.config.email}`);

        return { success: true };
      } catch (error) {
        instance.imapClient = undefined;
        throw new Error(
          `Failed to start monitoring: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    /**
     * Stop monitoring inbox
     */
    stopMonitoring: async (accountId: string): Promise<{ success: boolean }> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      if (!instance.isMonitoring || !instance.imapClient) {
        return { success: true };
      }

      try {
        await instance.imapClient.logout();
      } catch (e) {
        // Ignore logout errors
      }

      instance.imapClient = undefined;
      instance.isMonitoring = false;

      console.log(`[email] Stopped monitoring ${instance.config.email}`);

      return { success: true };
    },

    /**
     * Register a callback for new emails
     */
    onNewEmail: (accountId: string, callback: NewEmailCallback): void => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      instance.newEmailHandlers.add(callback);
    },

    /**
     * Unregister a callback for new emails
     */
    offNewEmail: (accountId: string, callback: NewEmailCallback): void => {
      const instance = accounts.get(accountId);
      if (!instance) {
        return;
      }

      instance.newEmailHandlers.delete(callback);
    },

    /**
     * Get list of folders/mailboxes for an account
     */
    listFolders: async (accountId: string): Promise<Array<{ name: string; path: string; specialUse?: string }>> => {
      const instance = accounts.get(accountId);
      if (!instance) {
        throw new Error(`Account not found: ${accountId}`);
      }

      const client = createImapClient(instance.config);

      try {
        await client.connect();

        const folders: Array<{ name: string; path: string; specialUse?: string }> = [];

        for await (const folder of client.list()) {
          folders.push({
            name: folder.name,
            path: folder.path,
            specialUse: folder.specialUse,
          });
        }

        return folders;
      } finally {
        await client.logout();
      }
    },
  },
};

export default emailPlugin;
