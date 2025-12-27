import nodemailer, { Transporter } from 'nodemailer';
import { createLogger } from '@cortex/shared';

const logger = createLogger('EmailService');

export interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromAddress?: string;
  fromName?: string;
}

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

/**
 * Email Service for sending emails via SMTP
 * Used by email-type tools that don't require JavaScript code
 */
export class EmailService {
  /**
   * Send email using SMTP configuration
   */
  static async sendEmail(
    config: SMTPConfig,
    params: SendEmailParams
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      // Validate required fields
      if (!config.host || !config.user || !config.password) {
        throw new Error('SMTP host, user, and password are required');
      }

      if (!params.to || !params.subject) {
        throw new Error('Email to and subject are required');
      }

      if (!params.text && !params.html) {
        throw new Error('Email text or html content is required');
      }

      // Create transporter
      // For Azure/Gmail, use requireTLS for port 587, secure for port 465
      const transporterOptions: any = {
        host: config.host,
        port: config.port || 587,
        auth: {
          user: config.user,
          pass: config.password,
        },
      };

      // Configure SSL/TLS based on port
      if (config.port === 465 || config.secure === true) {
        // Port 465 uses SSL direct connection
        transporterOptions.secure = true;
      } else {
        // Port 587 uses STARTTLS
        transporterOptions.secure = false;
        transporterOptions.requireTLS = true;
      }

      // Add timeout and connection options for Azure environments
      transporterOptions.connectionTimeout = 30000; // 30 seconds
      transporterOptions.socketTimeout = 30000;
      transporterOptions.greetingTimeout = 30000;
      
      // For Azure, sometimes we need to allow self-signed certificates during STARTTLS
      if (!transporterOptions.secure) {
        transporterOptions.tls = {
          rejectUnauthorized: false, // Accept self-signed certs (Azure sometimes uses these)
        };
      }

      const transporter = nodemailer.createTransport(transporterOptions);

      // Verify connection with longer timeout
      logger.info('Verifying SMTP connection', {
        host: config.host,
        port: transporterOptions.port,
        secure: transporterOptions.secure,
        requireTLS: transporterOptions.requireTLS,
        user: config.user,
      });

      try {
        await transporter.verify();
        logger.info('SMTP connection verified successfully');
      } catch (verifyError: any) {
        logger.error('SMTP verification failed', {
          error: verifyError.message,
          code: verifyError.code,
          command: verifyError.command,
          response: verifyError.response,
          responseCode: verifyError.responseCode,
          host: config.host,
          port: transporterOptions.port,
        });
        throw verifyError;
      }

      // Prepare from address
      const from = config.fromAddress
        ? config.fromName
          ? `${config.fromName} <${config.fromAddress}>`
          : config.fromAddress
        : config.user;

      // Send email
      const info = await transporter.sendMail({
        from,
        to: Array.isArray(params.to) ? params.to.join(', ') : params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        cc: params.cc ? (Array.isArray(params.cc) ? params.cc.join(', ') : params.cc) : undefined,
        bcc: params.bcc ? (Array.isArray(params.bcc) ? params.bcc.join(', ') : params.bcc) : undefined,
        replyTo: params.replyTo,
      });

      logger.info('Email sent successfully', {
        messageId: info.messageId,
        to: params.to,
        subject: params.subject,
      });

      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (error: any) {
      logger.error('Failed to send email', {
        error: error.message,
        to: params.to,
        subject: params.subject,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Validate SMTP configuration
   */
  static async validateConfig(config: SMTPConfig): Promise<{ valid: boolean; error?: string }> {
    try {
      if (!config.host || !config.user || !config.password) {
        return {
          valid: false,
          error: 'SMTP host, user, and password are required',
        };
      }

      // For Azure/Gmail, use requireTLS for port 587, secure for port 465
      const transporterOptions: any = {
        host: config.host,
        port: config.port || 587,
        auth: {
          user: config.user,
          pass: config.password,
        },
      };

      // Configure SSL/TLS based on port
      if (config.port === 465 || config.secure === true) {
        transporterOptions.secure = true;
      } else {
        transporterOptions.secure = false;
        transporterOptions.requireTLS = true;
      }

      // Add timeout and connection options for Azure environments
      transporterOptions.connectionTimeout = 30000;
      transporterOptions.socketTimeout = 30000;
      transporterOptions.greetingTimeout = 30000;
      
      if (!transporterOptions.secure) {
        transporterOptions.tls = {
          rejectUnauthorized: false,
        };
      }

      const transporter = nodemailer.createTransport(transporterOptions);

      await transporter.verify();

      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: error.message,
      };
    }
  }
}

