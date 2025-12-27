/**
 * RoutingMatcher
 * Evaluates routing conditions to match incoming messages with orchestration flows
 */

export interface RoutingConditions {
  phone_numbers?: string[];
  bot_username?: string;
  email_address?: string;
  user_roles?: string[];
  time_ranges?: TimeRange[];
  metadata?: Record<string, any>;
  messagePattern?: string; // Regex pattern to match message content
  pattern?: string; // Alias for messagePattern
  description?: string; // Human-readable description (ignored by matcher)
}

export interface TimeRange {
  start: string; // "09:00"
  end: string; // "18:00"
  days?: string[]; // ["Mon", "Tue", "Wed", "Thu", "Fri"]
  timezone?: string; // "America/Argentina/Buenos_Aires"
}

export interface IncomingMessage {
  channelType: string;
  phoneNumber?: string; // For WhatsApp/SMS
  botUsername?: string; // For Telegram
  emailAddress?: string; // For Email
  userId?: string;
  userRoles?: string[];
  metadata?: Record<string, any>;
  timestamp?: Date;
  content?: string; // Message content for pattern matching
}

export class RoutingMatcher {
  /**
   * Check if a message matches the routing conditions
   */
  matches(message: IncomingMessage, conditions: RoutingConditions): boolean {
    // If no conditions specified, match all messages for this channel
    if (!conditions || Object.keys(conditions).length === 0) {
      return true;
    }

    // Phone number matching (WhatsApp, SMS)
    if (conditions.phone_numbers && conditions.phone_numbers.length > 0) {
      if (!message.phoneNumber) {
        return false;
      }
      const normalizedPhone = this.normalizePhoneNumber(message.phoneNumber);
      const matches = conditions.phone_numbers.some((phone) =>
        this.normalizePhoneNumber(phone) === normalizedPhone
      );
      if (!matches) {
        return false;
      }
    }

    // Bot username matching (Telegram)
    if (conditions.bot_username) {
      if (message.botUsername !== conditions.bot_username) {
        return false;
      }
    }

    // Email address matching (Email channel)
    if (conditions.email_address) {
      if (message.emailAddress?.toLowerCase() !== conditions.email_address.toLowerCase()) {
        return false;
      }
    }

    // User role matching
    if (conditions.user_roles && conditions.user_roles.length > 0) {
      if (!message.userRoles || message.userRoles.length === 0) {
        return false;
      }
      const hasRole = conditions.user_roles.some((role) =>
        message.userRoles!.includes(role)
      );
      if (!hasRole) {
        return false;
      }
    }

    // Time range matching
    if (conditions.time_ranges && conditions.time_ranges.length > 0) {
      const timestamp = message.timestamp || new Date();
      const inTimeRange = conditions.time_ranges.some((range) =>
        this.isInTimeRange(timestamp, range)
      );
      if (!inTimeRange) {
        return false;
      }
    }

    // Metadata matching
    if (conditions.metadata) {
      // If metadata conditions is an empty object {}, it means "match any metadata" (no restrictions)
      if (Object.keys(conditions.metadata).length > 0) {
        if (!message.metadata) {
          return false;
        }
        for (const [key, value] of Object.entries(conditions.metadata)) {
          if (message.metadata[key] !== value) {
            return false;
          }
        }
      }
      // If metadata conditions is empty {}, continue (no metadata restrictions)
    }

    // Message pattern matching
    const patternToMatch = conditions.messagePattern || conditions.pattern;
    if (patternToMatch) {
      // Normalize content to empty string if undefined/null to allow regex matching
      // This allows patterns like ".*" to match empty content (e.g., image messages)
      const contentToMatch = message.content ?? '';
      try {
        const regex = new RegExp(patternToMatch, 'i'); // Case insensitive
        if (!regex.test(contentToMatch)) {
          return false;
        }
      } catch (error) {
        // Invalid regex pattern, skip matching
        console.warn(`Invalid regex pattern: ${patternToMatch}`, error);
      }
    }

    // All conditions passed
    return true;
  }

  /**
   * Normalize phone number to E.164 format for consistent comparison
   */
  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters
    let normalized = phone.replace(/\D/g, '');

    // Ensure it starts with +
    if (!phone.startsWith('+')) {
      normalized = '+' + normalized;
    } else {
      normalized = '+' + normalized;
    }

    return normalized;
  }

  /**
   * Check if timestamp is within time range
   */
  private isInTimeRange(timestamp: Date, range: TimeRange): boolean {
    const timezone = range.timezone || 'UTC';

    // Use Intl.DateTimeFormat for timezone conversion
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    });

    const parts = formatter.formatToParts(timestamp);
    const timeStr = `${parts.find((p) => p.type === 'hour')?.value}:${
      parts.find((p) => p.type === 'minute')?.value
    }`;
    const dayStr = parts.find((p) => p.type === 'weekday')?.value;

    // Check day of week
    if (range.days && range.days.length > 0) {
      if (!range.days.includes(dayStr!)) {
        return false;
      }
    }

    // Check time range
    const currentTime = this.timeToMinutes(timeStr);
    const startTime = this.timeToMinutes(range.start);
    const endTime = this.timeToMinutes(range.end);

    return currentTime >= startTime && currentTime <= endTime;
  }

  /**
   * Convert time string "HH:MM" to minutes since midnight
   */
  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Find best matching flow for a message
   * Returns flows sorted by priority (lower number = higher priority)
   */
  findMatchingFlows(
    message: IncomingMessage,
    flows: Array<{ id: string; priority: number; routing_conditions: RoutingConditions }>
  ): Array<{ id: string; priority: number }> {
    const matchingFlows = flows
      .filter((flow) => this.matches(message, flow.routing_conditions))
      .sort((a, b) => a.priority - b.priority);

    return matchingFlows;
  }
}
