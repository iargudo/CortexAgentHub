import nodemailer, { Transporter } from 'nodemailer';
import { simpleParser } from 'mailparser';
import {
  ChannelType,
  NormalizedMessage,
  OutgoingMessage,
  EmailConfig,
  ChannelError,
  ERROR_CODES,
} from '@cortex/shared';
import { BaseChannelAdapter } from '../base/BaseChannelAdapter';

/**
 * Email adapter using SMTP for sending and optional IMAP for receiving
 */
export class EmailAdapter extends BaseChannelAdapter {
  readonly channelType = ChannelType.EMAIL;

  private transporter!: Transporter;

  async initialize(config: any): Promise<void> {
    await super.initialize(config);
    this.config = config.config as EmailConfig;

    // Setup SMTP transporter
    this.transporter = nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth: {
        user: this.config.smtp.user,
        pass: this.config.smtp.pass,
      },
    });

    // Verify connection
    try {
      await this.transporter.verify();
      this.logger.info('Email adapter initialized successfully', {
        smtpHost: this.config.smtp.host,
      });
    } catch (error: any) {
      this.logger.error('Failed to verify SMTP connection', { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_NOT_CONFIGURED,
        'Failed to initialize email adapter'
      );
    }
  }

  /**
   * Send an email
   */
  async sendMessage(userId: string, message: OutgoingMessage): Promise<void> {
    this.ensureInitialized();

    try {
      const mailOptions = {
        from: this.config.fromAddress,
        to: userId, // userId is email address
        subject: message.metadata?.subject || 'Message from AI Assistant',
        text: message.content,
        html: message.metadata?.html || this.convertToHtml(message.content),
      };

      const info = await this.transporter.sendMail(mailOptions);

      this.logger.info(`Email sent to: ${userId}`, {
        messageId: info.messageId,
      });
    } catch (error: any) {
      this.logger.error(`Failed to send email to ${userId}`, {
        error: error.message,
      });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send email: ${error.message}`
      );
    }
  }

  /**
   * Send an email with attachments
   */
  async sendEmailWithAttachments(
    to: string,
    subject: string,
    content: string,
    attachments: Array<{
      filename: string;
      path?: string;
      content?: Buffer;
      contentType?: string;
    }>
  ): Promise<void> {
    this.ensureInitialized();

    try {
      const mailOptions = {
        from: this.config.fromAddress,
        to,
        subject,
        text: content,
        html: this.convertToHtml(content),
        attachments,
      };

      await this.transporter.sendMail(mailOptions);

      this.logger.info(`Email with attachments sent to: ${to}`);
    } catch (error: any) {
      this.logger.error('Failed to send email with attachments', {
        error: error.message,
      });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send email with attachments: ${error.message}`
      );
    }
  }

  /**
   * Send HTML email
   */
  async sendHtmlEmail(to: string, subject: string, html: string): Promise<void> {
    this.ensureInitialized();

    try {
      const mailOptions = {
        from: this.config.fromAddress,
        to,
        subject,
        html,
      };

      await this.transporter.sendMail(mailOptions);

      this.logger.info(`HTML email sent to: ${to}`);
    } catch (error: any) {
      this.logger.error('Failed to send HTML email', { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send HTML email: ${error.message}`
      );
    }
  }

  /**
   * Parse and normalize an email message
   */
  receiveMessage(payload: any): NormalizedMessage {
    this.ensureInitialized();

    if (!payload.from || !payload.text) {
      throw new ChannelError(
        ERROR_CODES.CHANNEL_WEBHOOK_INVALID,
        'Invalid email payload'
      );
    }

    const fromEmail = this.extractEmail(payload.from);

    // Create or update session
    this.createOrUpdateSession(fromEmail, {
      subject: payload.subject,
      messageId: payload.messageId,
      inReplyTo: payload.inReplyTo,
    });

    return this.normalizeMessage(fromEmail, fromEmail, payload.text, {
      subject: payload.subject,
      messageId: payload.messageId,
      html: payload.html,
      attachments: payload.attachments,
      headers: payload.headers,
    });
  }

  /**
   * Handle webhook from email service (e.g., SendGrid, Mailgun)
   */
  async handleWebhook(payload: any): Promise<NormalizedMessage | null> {
    this.ensureInitialized();

    try {
      // Different email services have different webhook formats
      // This is a generic implementation that can be adapted

      if (payload.email) {
        // Parse email content
        const parsed = await simpleParser(payload.email);

        // Extract email addresses from AddressObject
        // 'from' is AddressObject | undefined, 'to' can be AddressObject | AddressObject[] | undefined
        const fromText = parsed.from?.text || '';
        const toText = Array.isArray(parsed.to)
          ? parsed.to[0]?.text || ''
          : parsed.to?.text || '';

        return this.receiveMessage({
          from: fromText,
          to: toText,
          subject: parsed.subject || '',
          text: parsed.text || '',
          html: parsed.html || '',
          messageId: parsed.messageId || '',
          inReplyTo: parsed.inReplyTo || '',
          attachments: parsed.attachments || [],
          headers: parsed.headers,
        });
      }

      // Handle SendGrid format
      if (payload.from && payload.subject) {
        return this.receiveMessage(payload);
      }

      this.logger.warn('Unknown email webhook format');
      return null;
    } catch (error: any) {
      this.logger.error('Error handling email webhook', { error: error.message });
      throw error;
    }
  }

  /**
   * Extract email address from various formats
   */
  private extractEmail(emailString: string): string {
    const match = emailString.match(/<(.+?)>/) || emailString.match(/([^\s]+@[^\s]+)/);
    return match ? match[1] : emailString;
  }

  /**
   * Convert plain text to simple HTML
   */
  private convertToHtml(text: string): string {
    return text
      .split('\n')
      .map((line) => `<p>${this.escapeHtml(line)}</p>`)
      .join('');
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Send a reply to an existing thread
   */
  async sendReply(
    to: string,
    subject: string,
    content: string,
    inReplyTo: string,
    references?: string
  ): Promise<void> {
    this.ensureInitialized();

    try {
      const mailOptions = {
        from: this.config.fromAddress,
        to,
        subject: subject.startsWith('Re: ') ? subject : `Re: ${subject}`,
        text: content,
        html: this.convertToHtml(content),
        inReplyTo,
        references: references || inReplyTo,
      };

      await this.transporter.sendMail(mailOptions);

      this.logger.info(`Reply sent to: ${to}`);
    } catch (error: any) {
      this.logger.error('Failed to send reply', { error: error.message });
      throw new ChannelError(
        ERROR_CODES.CHANNEL_SEND_FAILED,
        `Failed to send reply: ${error.message}`
      );
    }
  }

  /**
   * Send bulk emails (with rate limiting consideration)
   */
  async sendBulk(
    recipients: string[],
    subject: string,
    content: string,
    delayMs: number = 100
  ): Promise<void> {
    this.ensureInitialized();

    this.logger.info(`Sending bulk email to ${recipients.length} recipients`);

    for (const recipient of recipients) {
      try {
        await this.sendMessage(recipient, {
          channelUserId: recipient,
          content,
          metadata: { subject },
        });

        // Add delay to avoid rate limiting
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (error: any) {
        this.logger.error(`Failed to send bulk email to ${recipient}`, {
          error: error.message,
        });
        // Continue with next recipient
      }
    }

    this.logger.info('Bulk email sending completed');
  }

  /**
   * Verify email address format
   */
  isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Shutdown the adapter
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Email adapter');

    if (this.transporter) {
      this.transporter.close();
    }

    this.sessions.clear();
  }

  /**
   * Get transporter for advanced usage
   */
  getTransporter(): Transporter {
    return this.transporter;
  }
}
