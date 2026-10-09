-- A bot operation may be delivered more than once by QStash. Reserve its
-- schedule link by the internal user ID and bot operation key before calling
-- Google Calendar.
--
-- Do not delete or merge existing schedule_links rows here. If production data
-- already contains duplicates, stop before changing the schema and resolve
-- them through an explicit, reviewed data migration before retrying 0010.
DO $$
DECLARE
  duplicate_count integer;
BEGIN
  SELECT count(*)
    INTO duplicate_count
    FROM (
      SELECT user_id, bot_event_id
      FROM public.schedule_links
      GROUP BY user_id, bot_event_id
      HAVING count(*) > 1
    ) duplicates;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      '0010 aborted: % duplicate schedule_links (user_id, bot_event_id) groups exist; no rows were deleted',
      duplicate_count
      USING ERRCODE = 'unique_violation';
  END IF;
END
$$;

create unique index schedule_links_user_bot_event_unique
  on public.schedule_links (user_id, bot_event_id);
