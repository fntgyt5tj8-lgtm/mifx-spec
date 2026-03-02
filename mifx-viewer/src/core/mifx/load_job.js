export async function loadJob(source) {
  const job = await source.getJson("job.json");

  if (!job) {
    throw new Error("Invalid MIFX package (missing job.json)");
  }

  return job;
}