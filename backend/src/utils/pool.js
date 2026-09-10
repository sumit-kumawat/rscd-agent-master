/** Run async tasks with a fixed concurrency limit. */
async function runPool(items, concurrency, worker) {
  const limit = Math.max(1, concurrency);
  let index = 0;
  const results = new Array(items.length);

  async function next() {
    while (index < items.length) {
      const i = index++;
      results[i] = await worker(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
  return results;
}

module.exports = { runPool };
