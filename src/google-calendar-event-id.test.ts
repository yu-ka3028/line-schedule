import { describe, expect, it } from 'vitest';

import { googleCalendarEventIdFromOperationKey } from './google-calendar-event-id.js';

describe('googleCalendarEventIdFromOperationKey', () => {
  it('maps the same operation key to the same safe event ID', () => {
    const eventId = googleCalendarEventIdFromOperationKey('job-id');

    expect(googleCalendarEventIdFromOperationKey('job-id')).toBe(eventId);
    expect(eventId).toMatch(/^[a-v0-9]+$/);
    expect(eventId.length).toBeLessThanOrEqual(1024);
  });

  it('maps different operation keys to different event IDs', () => {
    expect(googleCalendarEventIdFromOperationKey('job-1')).not.toBe(
      googleCalendarEventIdFromOperationKey('job-2'),
    );
  });

  it('does not put the operation key or event content into the ID', () => {
    const operationKey = 'job-id-with-title-and-secret-token';
    const eventId = googleCalendarEventIdFromOperationKey(operationKey);

    expect(eventId).not.toContain(operationKey);
    expect(eventId).not.toContain('title');
    expect(eventId).not.toContain('secret');
    expect(eventId).not.toContain('token');
  });
});
