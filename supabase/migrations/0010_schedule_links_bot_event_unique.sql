-- A bot operation may be delivered more than once by QStash. Reserve its
-- schedule link by the internal user ID and bot operation key before calling
-- Google Calendar.
create unique index schedule_links_user_bot_event_unique
  on public.schedule_links (user_id, bot_event_id);
