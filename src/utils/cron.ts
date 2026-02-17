/**
 * Cron expression parser and human-readable formatter
 * Supports: minute hour day month weekday
 */

export interface CronParts {
  minute: string;
  hour: string;
  day: string;
  month: string;
  weekday: string;
}

export interface CronHumanReadable {
  summary: string;
  description: string;
  parts: CronParts;
  nextRuns: string[];
}

/**
 * Parse a cron expression into its parts
 */
export function parseCron(cronExpr: string): CronParts | null {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) {
    return null;
  }
  return {
    minute: parts[0],
    hour: parts[1],
    day: parts[2],
    month: parts[3],
    weekday: parts[4],
  };
}

/**
 * Format a single cron part into human-readable text
 */
function formatPart(part: string, type: 'minute' | 'hour' | 'day' | 'month' | 'weekday'): string {
  if (part === '*') {
    switch (type) {
      case 'minute': return 'every minute';
      case 'hour': return 'every hour';
      case 'day': return 'every day';
      case 'month': return 'every month';
      case 'weekday': return 'every day of the week';
    }
  }

  // Handle */N patterns
  if (part.startsWith('*/')) {
    const n = parseInt(part.slice(2));
    if (isNaN(n) || n <= 0) return part;

    switch (type) {
      case 'minute': return n === 1 ? 'every minute' : `every ${n} minutes`;
      case 'hour': return n === 1 ? 'every hour' : `every ${n} hours`;
      case 'day': return `every ${n} days`;
      case 'month': return `every ${n} months`;
      case 'weekday': return n === 1 ? 'every day' : `every ${n} days`;
    }
  }

  // Handle single value
  const num = parseInt(part);
  if (!isNaN(num)) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    switch (type) {
      case 'minute': return `at minute ${num}`;
      case 'hour': return `at ${num}:00`;
      case 'day': return `on day ${num}`;
      case 'month': return `in ${monthNames[num - 1] || part}`;
      case 'weekday': return dayNames[num] || `day ${num}`;
    }
  }

  return part;
}

/**
 * Get next run times for a cron expression
 */
function getNextRuns(cronExpr: string, count: number = 5): string[] {
  const runs: string[] = [];
  const parts = parseCron(cronExpr);
  if (!parts) return runs;

  const now = new Date();
  let checkTime = new Date(now);
  checkTime.setSeconds(0, 0);
  checkTime.setMinutes(checkTime.getMinutes() + 1); // Start from next minute

  const maxChecks = count * 60 * 24; // Limit checks to avoid infinite loops
  let checks = 0;

  while (runs.length < count && checks < maxChecks) {
    checks++;

    const matches = checkCronMatch(cronExpr, checkTime);
    if (matches) {
      // Format the time
      const timeStr = checkTime.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      runs.push(timeStr);
    }

    // Move to next minute
    checkTime.setMinutes(checkTime.getMinutes() + 1);
  }

  return runs;
}

/**
 * Check if a time matches a cron expression
 */
function checkCronMatch(cronExpr: string, date: Date): boolean {
  const parts = parseCron(cronExpr);
  if (!parts) return false;

  const matches = (pattern: string, value: number, max: number): boolean => {
    if (pattern === '*') return true;
    if (pattern.startsWith('*/')) {
      const n = parseInt(pattern.slice(2));
      if (isNaN(n) || n <= 0) return false;
      return value % n === 0;
    }
    const n = parseInt(pattern);
    return !isNaN(n) && n === value;
  };

  return (
    matches(parts.minute, date.getMinutes(), 59) &&
    matches(parts.hour, date.getHours(), 23) &&
    matches(parts.day, date.getDate(), 31) &&
    matches(parts.month, date.getMonth() + 1, 12) &&
    matches(parts.weekday, date.getDay(), 6)
  );
}

/**
 * Convert a cron expression to human-readable format
 */
export function cronToHumanReadable(cronExpr: string): CronHumanReadable {
  const parts = parseCron(cronExpr) || {
    minute: '*',
    hour: '*',
    day: '*',
    month: '*',
    weekday: '*',
  };

  const minuteDesc = formatPart(parts.minute, 'minute');
  const hourDesc = formatPart(parts.hour, 'hour');
  const dayDesc = formatPart(parts.day, 'day');
  const monthDesc = formatPart(parts.month, 'month');
  const weekdayDesc = formatPart(parts.weekday, 'weekday');

  // Build a human-readable summary
  const descriptions: string[] = [];

  // Check if it's a common pattern
  if (parts.minute === '0' && parts.hour === '*' && parts.day === '*' && parts.month === '*' && parts.weekday === '*') {
    descriptions.push('At the start of every hour');
  } else if (parts.minute === '0' && parts.hour === '0' && parts.day === '*' && parts.month === '*' && parts.weekday === '*') {
    descriptions.push('At midnight every day');
  } else if (parts.minute === '0' && parts.hour === '0' && parts.day === '1' && parts.month === '*' && parts.weekday === '*') {
    descriptions.push('At midnight on the 1st of every month');
  } else if (parts.minute === '0' && parts.hour === '*') {
    descriptions.push(minuteDesc);
  } else if (parts.day === '*' && parts.month === '*' && parts.weekday === '*') {
    descriptions.push(`${hourDesc} ${minuteDesc ? 'and ' + minuteDesc : ''}`);
  } else if (parts.weekday !== '*' && parts.day === '*') {
    descriptions.push(`${weekdayDesc} at ${hourDesc.startsWith('every') ? '00:00' : hourDesc.replace('at ', '')} ${minuteDesc !== 'every minute' ? minuteDesc.replace('at ', 'and ') : ''}`);
  } else if (parts.day !== '*') {
    descriptions.push(`${dayDesc} of each month at ${hourDesc.startsWith('every') ? '00:00' : hourDesc.replace('at ', '')}`);
  } else {
    // General case - build from parts
    if (parts.weekday !== '*') descriptions.push(weekdayDesc);
    if (parts.day !== '*') descriptions.push(dayDesc);
    if (parts.month !== '*') descriptions.push(monthDesc);
    if (parts.hour !== '*') descriptions.push(hourDesc);
    if (parts.minute !== '*' && parts.minute !== '0') descriptions.push(minuteDesc);
  }

  const summary = descriptions.length > 0
    ? descriptions.filter(d => d).join(', ')
    : 'According to schedule';

  return {
    summary,
    description: cronExpr,
    parts,
    nextRuns: getNextRuns(cronExpr),
  };
}

/**
 * Format a cron schedule for display with a table
 */
export function formatCronTable(cronExpr: string): string {
  const human = cronToHumanReadable(cronExpr);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const formatField = (value: string, type: 'minute' | 'hour' | 'day' | 'month' | 'weekday'): string => {
    if (value === '*') return ' * ';

    if (value.startsWith('*/')) {
      const n = value.slice(2);
      switch (type) {
        case 'minute': return `*/${n}`.padEnd(3);
        case 'hour': return `*/${n}`.padEnd(3);
        case 'day': return `*/${n}`.padEnd(3);
        case 'month': return `*/${n}`.padEnd(3);
        case 'weekday': return `*/${n}`.padEnd(3);
      }
    }

    const num = parseInt(value);
    if (!isNaN(num)) {
      switch (type) {
        case 'minute': return value.padEnd(3);
        case 'hour': return value.padEnd(3);
        case 'day': return value.padEnd(3);
        case 'month': return monthNames[num - 1] || value;
        case 'weekday': return dayNames[num] || value;
      }
    }

    return value;
  };

  const minute = formatField(human.parts.minute, 'minute');
  const hour = formatField(human.parts.hour, 'hour');
  const day = formatField(human.parts.day, 'day');
  const month = formatField(human.parts.month, 'month');
  const weekday = formatField(human.parts.weekday, 'weekday');

  let output = '';
  output += `┌──────────── minute (0 - 59)\n`;
  output += `│  └───────── hour (0 - 23)\n`;
  output += `│   └─────── day of month (1 - 31)\n`;
  output += `│    └───── month (1 - 12 or Jan - Dec)\n`;
  output += `│      └─── day of week (0 - 6 or Sun - Sat)\n`;
  output += `│\n`;
  output += `   ${minute}   ${hour}    ${day}     ${month}    ${weekday}\n`;
  output += `\n`;
  output += `   ${human.summary}\n`;

  if (human.nextRuns.length > 0) {
    output += `\n   Next runs: ${human.nextRuns.slice(0, 3).join(', ')}`;
  }

  return output;
}

/**
 * Build a cron expression from parts
 */
export function buildCronExpression(parts: CronParts): string {
  return `${parts.minute} ${parts.hour} ${parts.day} ${parts.month} ${parts.weekday}`;
}

/**
 * Validate a cron expression
 */
export function validateCronExpression(expr: string): { valid: boolean; error?: string } {
  const parts = parseCron(expr);
  if (!parts) {
    return { valid: false, error: 'Invalid cron expression format. Expected 5 space-separated fields.' };
  }

  const validateField = (value: string, fieldName: string, min: number, max: number): string | null => {
    if (value === '*') return null;
    
    if (value.startsWith('*/')) {
      const n = parseInt(value.slice(2));
      if (isNaN(n) || n <= 0) {
        return `${fieldName} interval must be a positive number`;
      }
      return null;
    }

    const num = parseInt(value);
    if (isNaN(num)) {
      return `${fieldName} must be a number, '*', or '*/N'`;
    }

    if (num < min || num > max) {
      return `${fieldName} must be between ${min} and ${max}`;
    }

    return null;
  };

  const minuteError = validateField(parts.minute, 'Minute', 0, 59);
  if (minuteError) return { valid: false, error: minuteError };

  const hourError = validateField(parts.hour, 'Hour', 0, 23);
  if (hourError) return { valid: false, error: hourError };

  const dayError = validateField(parts.day, 'Day', 1, 31);
  if (dayError) return { valid: false, error: dayError };

  const monthError = validateField(parts.month, 'Month', 1, 12);
  if (monthError) return { valid: false, error: monthError };

  const weekdayError = validateField(parts.weekday, 'Weekday', 0, 6);
  if (weekdayError) return { valid: false, error: weekdayError };

  return { valid: true };
}

/**
 * Get common schedule templates
 */
export function getCommonSchedules(): Array<{ name: string; cron: string; description: string }> {
  return [
    { name: 'Every minute', cron: '* * * * *', description: 'Runs every minute' },
    { name: 'Every 5 minutes', cron: '*/5 * * * *', description: 'Runs every 5 minutes' },
    { name: 'Every 15 minutes', cron: '*/15 * * * *', description: 'Runs every 15 minutes' },
    { name: 'Every 30 minutes', cron: '*/30 * * * *', description: 'Runs every 30 minutes' },
    { name: 'Every hour', cron: '0 * * * *', description: 'Runs at the start of every hour' },
    { name: 'Every 6 hours', cron: '0 */6 * * *', description: 'Runs every 6 hours at :00 minutes' },
    { name: 'Every 12 hours', cron: '0 */12 * * *', description: 'Runs every 12 hours at :00 minutes' },
    { name: 'Daily at midnight', cron: '0 0 * * *', description: 'Runs daily at midnight' },
    { name: 'Daily at 9 AM', cron: '0 9 * * *', description: 'Runs daily at 9:00 AM' },
    { name: 'Daily at noon', cron: '0 12 * * *', description: 'Runs daily at noon' },
    { name: 'Weekdays at 9 AM', cron: '0 9 * * 1-5', description: 'Runs weekdays (Mon-Fri) at 9:00 AM' },
    { name: 'Weekly on Monday', cron: '0 9 * * 1', description: 'Runs every Monday at 9:00 AM' },
    { name: 'Monthly on 1st', cron: '0 0 1 * *', description: 'Runs on the 1st of every month at midnight' },
  ];
}

/**
 * Explain a single cron field value
 */
export function explainCronField(value: string, field: 'minute' | 'hour' | 'day' | 'month' | 'weekday'): string {
  if (value === '*') {
    switch (field) {
      case 'minute': return 'Every minute';
      case 'hour': return 'Every hour';
      case 'day': return 'Every day';
      case 'month': return 'Every month';
      case 'weekday': return 'Every day of the week';
    }
  }

  if (value.startsWith('*/')) {
    const n = parseInt(value.slice(2));
    if (isNaN(n) || n <= 0) return value;

    switch (field) {
      case 'minute': return n === 1 ? 'Every minute' : `Every ${n} minutes`;
      case 'hour': return n === 1 ? 'Every hour' : `Every ${n} hours`;
      case 'day': return `Every ${n} days`;
      case 'month': return `Every ${n} months`;
      case 'weekday': return n === 1 ? 'Every day' : `Every ${n} days`;
    }
  }

  const num = parseInt(value);
  if (!isNaN(num)) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    switch (field) {
      case 'minute': return `At minute ${num}`;
      case 'hour': return `At ${num}:00`;
      case 'day': return `On day ${num}`;
      case 'month': return monthNames[num - 1] || `Month ${num}`;
      case 'weekday': return dayNames[num] || `Day ${num}`;
    }
  }

  return value;
}
