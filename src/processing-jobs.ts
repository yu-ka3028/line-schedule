export const MAX_QSTASH_BODY_BYTES = 4 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProcessingJob = { jobId: string };
export type JobExecutor = (
  job: ProcessingJob,
  token: string,
) => Promise<unknown | void>;

export function parseProcessingJobPayload(value: unknown): ProcessingJob {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('invalid payload');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    typeof record.jobId !== 'string' ||
    !UUID.test(record.jobId)
  )
    throw new Error('invalid payload');
  return { jobId: record.jobId };
}
